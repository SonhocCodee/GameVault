import React, { useState } from "react";
import { Camera, Check, Image as ImageIcon } from "lucide-react";
import type { CommunityAdapter, PublicProfile } from "../../shared/community.ts";
import { AVATAR_PRESETS, BANNER_PRESETS } from "../../shared/profile-presets.ts";
import { communityError, qualifyCommunityUrl } from "./client.ts";
import { presetAssetUrl } from "./profile-presets.ts";

export function ProfileEditor({ api, me, onSaved, onCancel, onBusyChange }: {
  api: CommunityAdapter;
  me: PublicProfile;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [nickname, setNickname] = useState(me.nickname);
  const [bio, setBio] = useState(me.bio);
  const [avatarPreset, setAvatarPreset] = useState<string | null>(me.avatarPreset || null);
  const [bannerPreset, setBannerPreset] = useState<string | null>(me.bannerPreset || null);
  const [picker, setPicker] = useState<"avatar" | "banner">("avatar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const avatarPreview = avatarPreset ? presetAssetUrl("avatars", avatarPreset)
    : me.defaultAvatarUrl || (!me.avatarPreset ? me.avatarUrl : "") || "";
  const bannerPreview = bannerPreset ? presetAssetUrl("banners", bannerPreset)
    : qualifyCommunityUrl(api.publicBase, me.defaultBannerUrl || (!me.bannerPreset ? me.bannerUrl : "") || "");
  const isAvatar = picker === "avatar";
  const selected = isAvatar ? avatarPreset : bannerPreset;
  const presets = isAvatar ? AVATAR_PRESETS : BANNER_PRESETS;
  const select = isAvatar ? setAvatarPreset : setBannerPreset;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await api.request("/me", "PUT", { nickname, bio, avatarPreset, bannerPreset });
      await onSaved();
    } catch (error) {
      setError(communityError(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <form className="gv-stack" onSubmit={(event) => void save(event)}>
      <fieldset className="gv-profile-editor-fields gv-stack" disabled={busy}>
        <div className="gv-profile-media-preview">
          <div className="gv-profile-cover-preview">
            {bannerPreview && <img src={bannerPreview} alt="Xem trước ảnh bìa" />}
          </div>
          <div className="gv-profile-avatar-preview">
            {avatarPreview ? <img src={avatarPreview} alt="Xem trước ảnh đại diện" /> : <span>{(nickname[0] || "P").toUpperCase()}</span>}
          </div>
        </div>
        <div className="gv-chip-row" aria-label="Chọn loại ảnh hồ sơ">
          <button type="button" className={`gv-chip ${isAvatar ? "active" : ""}`} aria-pressed={isAvatar} onClick={() => setPicker("avatar")}>
            <Camera size={14} /> Ảnh đại diện (20)
          </button>
          <button type="button" className={`gv-chip ${!isAvatar ? "active" : ""}`} aria-pressed={!isAvatar} onClick={() => setPicker("banner")}>
            <ImageIcon size={14} /> Ảnh bìa (20)
          </button>
        </div>
        <fieldset className="gv-profile-editor-fields gv-stack-sm">
          <legend className="gv-profile-picker-legend">{isAvatar ? "Chọn ảnh đại diện" : "Chọn ảnh bìa"}</legend>
          <label className="gv-profile-default-choice">
            <input type="radio" name={`profile-${picker}`} checked={selected === null} onChange={() => select(null)} />
            {isAvatar ? "Dùng ảnh tài khoản" : "Dùng bìa tự động từ thư viện"}
          </label>
          <div className={`gv-profile-preset-grid ${isAvatar ? "gv-avatar-presets" : "gv-banner-presets"}`}>
            {presets.map((preset) => (
              <label key={preset.id} className={`gv-profile-preset ${selected === preset.id ? "is-selected" : ""}`} title={preset.name}>
                <input type="radio" name={`profile-${picker}`} value={preset.id} checked={selected === preset.id} onChange={() => select(preset.id)} aria-label={preset.name} />
                <img src={presetAssetUrl(isAvatar ? "avatars" : "banners", preset.id)} alt="" width={isAvatar ? 64 : 160} height={isAvatar ? 64 : 40} />
                {!isAvatar && <span className="gv-preset-name">{preset.name}</span>}
                {selected === preset.id && <Check className="gv-preset-check" size={16} aria-hidden="true" />}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Biệt danh hiển thị
          <input required maxLength={60} value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </label>
        <label>
          Giới thiệu ngắn
          <textarea rows={3} maxLength={300} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Thể loại game yêu thích, cấu hình PC, gu chơi..." />
        </label>
      </fieldset>
      {error && <p className="gv-error" role="alert">{error}</p>}
      <div className="gv-modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Hủy</button>
        <button type="submit" className="gv-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </div>
    </form>
  );
}
