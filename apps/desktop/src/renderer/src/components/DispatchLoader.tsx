import loaderUrl from "../assets/postconet-dispatch-loader.svg?url";

export function DispatchLoader(props: { size?: number; className?: string }) {
  const width = props.size ?? 160;
  const height = Math.round((width * 200) / 240);
  return (
    <img
      src={loaderUrl}
      alt=""
      width={width}
      height={height}
      className={`pointer-events-none select-none ${props.className ?? ""}`}
      draggable={false}
    />
  );
}

export function DispatchLoaderFill(props: { size?: number; className?: string }) {
  return (
    <div
      className={`flex h-full w-full min-h-[120px] items-center justify-center ${props.className ?? ""}`}
      role="status"
      aria-label="Loading"
    >
      <DispatchLoader size={props.size ?? 160} />
    </div>
  );
}

export function DispatchLoaderOverlay(props: { size?: number }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--panel)]/75" role="status" aria-label="Loading">
      <DispatchLoader size={props.size ?? 140} />
    </div>
  );
}
