import { isProfilePreset, type ProfilePresetKind } from "../../shared/profile-presets.ts";

export function presetAssetUrl(kind: ProfilePresetKind, id: string): string {
  const base = (import.meta as any).env?.BASE_URL || "/community/";
  return isProfilePreset(kind, id) ? `${base}profile-presets/${kind}/${id}.svg` : "";
}

/** Resolve bundled profile artwork locally, including in an offline desktop build. */
export function localProfilePresetUrl(url: string): string | null {
  const match = /(?:^|\/)community\/profile-presets\/(avatars|banners)\/([a-z-]+)\.svg$/.exec(url);
  return match ? presetAssetUrl(match[1] as ProfilePresetKind, match[2]) || null : null;
}
