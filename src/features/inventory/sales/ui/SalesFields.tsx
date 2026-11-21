import { type ComponentProps, useId } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { CatalogField } from "../../catalog/ui/CatalogFields";

export function SalesInput({
  label,
  ...input
}: Omit<ComponentProps<typeof Input>, "id"> & { label: string }) {
  const id = useId();
  return (
    <CatalogField label={label} id={id}>
      <Input id={id} {...input} />
    </CatalogField>
  );
}

export function SalesTextarea({
  label,
  ...input
}: Omit<ComponentProps<typeof Textarea>, "id"> & { label: string }) {
  const id = useId();
  return (
    <CatalogField label={label} id={id}>
      <Textarea id={id} {...input} />
    </CatalogField>
  );
}
