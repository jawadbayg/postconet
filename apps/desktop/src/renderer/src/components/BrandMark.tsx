import logo from "../assets/postconet-logo.png";

export function BrandMark(props: { size?: number; className?: string }) {
  const size = props.size ?? 20;
  return (
    <img
      src={logo}
      alt="PostConet"
      width={size}
      height={size}
      className={`shrink-0 rounded-md ${props.className ?? ""}`}
      draggable={false}
    />
  );
}
