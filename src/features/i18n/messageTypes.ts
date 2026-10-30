// Generated English declarations retain literal copy for ICU typing. Resource maps need the
// same complete structure while permitting translated string values.
export type MessageCatalog<Source> = Source extends string
  ? string
  : Source extends object
    ? { [Key in keyof Source]: MessageCatalog<Source[Key]> }
    : Source;
