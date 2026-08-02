# Beat File Map

Devaps keeps the generated direct relationship graph in `.devaps/file-map.json`. Refresh that graph from the Files tab after reviewing the project.

## Relationship vocabulary

- **Uses**: this file directly imports, includes, invokes, or reads another project file.
- **Used by**: another project file directly depends on this file.
- Relationships are best-effort static analysis and should be treated as navigation evidence, not a complete runtime call graph.

## Key files

Add curated notes for the project’s important entry points and boundaries here. Devaps never overwrites this document after creation.