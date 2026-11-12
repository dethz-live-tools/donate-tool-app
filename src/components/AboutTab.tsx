interface AboutTabProps {
  updateChecked: boolean;
  checkingUpdate: boolean;
  updateError: string | null;
  latestRelease: { tag: string; url: string } | null;
  onCheckUpdate: () => void;
}

export const AboutTab: React.FC<AboutTabProps> = ({
  updateChecked,
  checkingUpdate,
  updateError,
  latestRelease,
  onCheckUpdate,
}) => {
  let statusNode;
  if (checkingUpdate) {
    statusNode = <span className="status-chip connecting">CHECKING...</span>;
  } else if (updateError) {
    statusNode = <span className="status-chip error">CHECK FAILED: {updateError}</span>;
  } else if (!updateChecked) {
    statusNode = <span className="status-chip disconnected">NOT CHECKED</span>;
  } else if (latestRelease) {
    statusNode = <span className="status-chip">UPDATE AVAILABLE: {latestRelease.tag}</span>;
  } else {
    statusNode = <span className="status-chip connected">UP TO DATE (latest: {__APP_VERSION__})</span>;
  }

  return (
    <section className="raw-card elevated about-card">
      <h2 className="card-title">ABOUT // donate-socket</h2>
      <p className="form-helper">
        Real-time TikTok LIVE donation bridge and Spotify playback status desktop tool.
      </p>

      <dl className="about-info">
        <dt>App version</dt>
        <dd className="mono-font">{__APP_VERSION__}</dd>

        <dt>Update status</dt>
        <dd>{statusNode}</dd>
      </dl>

      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onCheckUpdate} disabled={checkingUpdate}>
          {checkingUpdate ? "CHECKING..." : "CHECK FOR UPDATES"}
        </button>
      </div>
    </section>
  );
};
