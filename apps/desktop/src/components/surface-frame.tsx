import { useCallback, useRef, useState } from "react";
import tabbyLogoUrl from "../../assets/happytabby-logo.png";

function TabbyLoader({ size = 152 }: { size?: number }) {
  return (
    <div
      className="tabby-loader"
      role="img"
      aria-label="Tabby loading"
      style={{ width: size }}
    >
      <img
        className="tabby-loader-logo"
        src={tabbyLogoUrl}
        alt=""
        draggable={false}
      />
      <span className="tabby-loader-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export function SurfaceFrame({
  title: _title,
  description: _description,
  src,
  version,
  preload,
}: {
  title: string;
  description: string;
  src: string | null;
  version: number;
  preload?: string;
}) {
  void _title;
  void _description;
  const [webviewReady, setWebviewReady] = useState(false);
  const prevSrcRef = useRef<string | null>(null);

  // Reset when src changes
  if (src !== prevSrcRef.current) {
    prevSrcRef.current = src;
    if (webviewReady) setWebviewReady(false);
  }

  const webviewRefCallback = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !src) return;
      if (preload) {
        el.setAttribute("preload", preload);
      }
      // Listen for did-finish-load right on the element before setting src.
      // This avoids the race where dom-ready fires before useEffect can bind.
      el.addEventListener("did-finish-load", () => setWebviewReady(true), {
        once: true,
      });
      el.setAttribute("src", src);
    },
    [preload, src],
  );

  const showLoader = !src || !webviewReady;

  return (
    <section className="surface-frame" style={{ position: "relative" }}>
      {/* Webview always rendered (hidden behind loader until ready) */}
      {src && (
        <webview
          ref={webviewRefCallback as React.Ref<HTMLWebViewElement>}
          className="desktop-web-frame"
          key={`${src}:${version}`}
          // @ts-expect-error Electron webview boolean attribute — must be empty string, not boolean
          allowpopups=""
          style={{ opacity: webviewReady ? 1 : 0 }}
        />
      )}

      {/* Loader overlay — covers webview until content is ready */}
      {showLoader && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#f7f4ed",
            zIndex: 10,
            transition: "opacity 0.3s ease-out",
          }}
        >
          <TabbyLoader />
        </div>
      )}
    </section>
  );
}
