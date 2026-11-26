import type { AuthStatus } from "../../shared/types.ts";
import type {
  CommunityRequest,
  PublicProfile,
} from "../../shared/community.ts";

export interface CommunityIdentity {
  profile: PublicProfile | null;
  state: "checking" | "ready" | "unavailable";
  expired?: boolean;
}

/** The app shell is authoritative for desktop sign-in; community failures are not sign-outs. */
export async function loadCommunityIdentity(
  request: CommunityRequest,
  shellAuth?: AuthStatus | null,
): Promise<CommunityIdentity> {
  if (shellAuth === null) return { profile: null, state: "checking" };
  if (shellAuth !== undefined && (!shellAuth.loggedIn || !shellAuth.profile))
    return { profile: null, state: "ready" };
  const fallback: PublicProfile | null = shellAuth?.profile
    ? {
        uid: shellAuth.profile.uid,
        nickname:
          shellAuth.profile.displayName &&
          !shellAuth.profile.displayName.includes("@")
            ? shellAuth.profile.displayName
            : "Player",
        bio: "",
        shareLibrary: false,
      }
    : null;
  try {
    const profile = await request<PublicProfile>("/me");
    if (!profile.avatarUrl && shellAuth?.profile?.photoUrl) {
      profile.avatarUrl = shellAuth.profile.photoUrl;
    }
    return { profile, state: "ready" };
  } catch (error) {
    const expired = /Sign in|401|Chưa đăng nhập/.test(
      String((error as Error).message),
    );
    if (expired && !fallback) return { profile: null, state: "ready" };
    return { profile: fallback, state: "unavailable", expired };
  }
}
