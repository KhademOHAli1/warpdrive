export async function uploadReleaseFile(
  post: { url: string; fields: Record<string, string> },
  file: File,
  contentType?: string,
) {
  const form = new FormData();
  for (const [field, value] of Object.entries(post.fields)) form.append(field, value);
  const body = contentType === undefined ? file : file.slice(0, file.size, contentType);
  form.append("file", body, file.name);
  const response = await fetch(post.url, { method: "POST", body: form, credentials: "omit" });
  return response.ok;
}
