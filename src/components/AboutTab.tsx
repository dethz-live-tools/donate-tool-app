interface AboutTabProps {
  updateChecked: boolean;
  checkingUpdate: boolean;
  updateError: string | null;
  latestRelease: { tag: string; url: string } | null;
  onCheckUpdate: () => void;
}

import { useLang } from "../i18n.tsx";

export const AboutTab: React.FC<AboutTabProps> = ({
  updateChecked,
  checkingUpdate,
  updateError,
  latestRelease,
  onCheckUpdate,
}) => {
  const { t } = useLang();
  let statusNode;
  if (checkingUpdate) {
    statusNode = <span className="status-chip connecting">{t("CHECKING...")}</span>;
  } else if (updateError) {
    statusNode = <span className="status-chip error">{t("CHECK FAILED: {err}").replace("{err}", String(updateError))}</span>;
  } else if (!updateChecked) {
    statusNode = <span className="status-chip disconnected">{t("NOT CHECKED")}</span>;
  } else if (latestRelease) {
    statusNode = <span className="status-chip">{t("UPDATE AVAILABLE: {tag}").replace("{tag}", latestRelease.tag)}</span>;
  } else {
    statusNode = <span className="status-chip connected">{t("UP TO DATE (latest: {v})").replace("{v}", __APP_VERSION__)}</span>;
  }

  return (
    <section className="raw-card elevated about-card">
      <h2 className="card-title">{t("ABOUT // donate-socket")}</h2>
      <p className="form-helper">
        {t("Real-time TikTok LIVE donation bridge and Spotify playback status desktop tool.")}
      </p>

      <dl className="about-info">
        <dt>{t("APP VERSION")}</dt>
        <dd className="mono-font">{__APP_VERSION__}</dd>

        <dt>{t("UPDATE STATUS")}</dt>
        <dd>{statusNode}</dd>
      </dl>

      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onCheckUpdate} disabled={checkingUpdate}>
          {checkingUpdate ? t("CHECKING...") : t("CHECK FOR UPDATES")}
        </button>
      </div>
    </section>
  );
};
