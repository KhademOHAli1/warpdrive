package main

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/knadh/stuffbin"
)

// The patched backend uses the unmodified, pinned upstream admin frontend bundle.
func extractAdmin(binary, destination string) error {
	files, err := stuffbin.UnStuff(binary)
	if err != nil {
		return err
	}
	for _, name := range files.List() {
		relative, admin := strings.CutPrefix(strings.TrimPrefix(name, "/"), "admin/")
		if !admin || relative == "" {
			continue
		}
		if !filepath.IsLocal(relative) {
			return fmt.Errorf("invalid upstream admin path %q", name)
		}
		data, err := files.Read(name)
		if err != nil {
			return err
		}
		output := filepath.Join(destination, relative)
		if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(output, data, 0644); err != nil {
			return err
		}
	}
	_, err = os.Stat(filepath.Join(destination, "index.html"))
	return err
}

func writeSourceArchive(source, output string) error {
	file, err := os.Create(output)
	if err != nil {
		return err
	}
	zipper := gzip.NewWriter(file)
	tarball := tar.NewWriter(zipper)
	walkErr := filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected source archive entry %q", path)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		name, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if err := tarball.WriteHeader(&tar.Header{
			Name: filepath.ToSlash(name), Mode: 0644, Size: info.Size(),
		}); err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tarball, input)
		return errors.Join(copyErr, input.Close())
	})
	return errors.Join(walkErr, tarball.Close(), zipper.Close(), file.Close())
}

func main() {
	if len(os.Args) != 4 {
		log.Fatal("Usage: build-assets admin|source INPUT OUTPUT")
	}
	var err error
	switch os.Args[1] {
	case "admin":
		err = extractAdmin(os.Args[2], os.Args[3])
	case "source":
		err = writeSourceArchive(os.Args[2], os.Args[3])
	default:
		log.Fatal("Unknown build-assets operation")
	}
	if err != nil {
		log.Fatal(err)
	}
}
