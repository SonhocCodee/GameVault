import React, { useState } from "react";
import { UserCheck, UserPlus } from "lucide-react";
import type { CommunityAdapter, PublicProfile } from "../../shared/community.ts";
import { communityError } from "./client.ts";

export function FollowButton({ api, profile, myUid, onSignIn, onChanged, onError }: {
  api: CommunityAdapter;
  profile: PublicProfile;
  myUid?: string;
  onSignIn: () => void;
  onChanged: (profile: PublicProfile) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (profile.uid === myUid) return null;
  return <button type="button" className="gv-btn-cyan" disabled={busy} aria-pressed={!!profile.isFollowing}
    onClick={async () => {
      if (!myUid) return onSignIn();
      setBusy(true);
      try {
        const next = await api.request<Pick<PublicProfile, "isFollowing" | "followersCount" | "followingCount">>(
          `/follows/${encodeURIComponent(profile.uid)}`, profile.isFollowing ? "DELETE" : "PUT");
        onChanged({ ...profile, ...next });
      } catch (error) {
        onError(communityError(error));
      } finally {
        setBusy(false);
      }
    }}>
    {profile.isFollowing ? <UserCheck size={15} /> : <UserPlus size={15} />}
    {busy ? "Đang lưu…" : profile.isFollowing ? "Đang theo dõi" : "Theo dõi"}
  </button>;
}
