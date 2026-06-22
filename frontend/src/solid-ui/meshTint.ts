export type MeshTintVariant = "a" | "b" | "c" | "d";

const meshTintVariants: MeshTintVariant[] = ["a", "b", "c", "d"];

export function meshTintVariantFor(seed: string | number | undefined | null): MeshTintVariant {
  const text = String(seed ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return meshTintVariants[Math.abs(hash) % meshTintVariants.length];
}
