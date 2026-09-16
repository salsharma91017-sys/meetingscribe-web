import type { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    />
  );
}

export function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12,14c1.66,0 3,-1.34 3,-3V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6C9,12.66 10.34,14 12,14z M17,11c0,2.76 -2.24,5 -5,5s-5,-2.24 -5,-5H5c0,3.53 2.61,6.43 6,6.92V21h2v-3.08c3.39,-0.49 6,-3.39 6,-6.92H17z" />
    </Base>
  );
}

export function StopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M6,6h12v12H6z" />
    </Base>
  );
}

export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M6,19h4V5H6v14z M14,5v14h4V5h-4z" />
    </Base>
  );
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M8,5v14l11,-7z" />
    </Base>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M19,13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </Base>
  );
}

export function BackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z" />
    </Base>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6V19z M19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z" />
    </Base>
  );
}

export function ShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M18,16.08c-0.76,0 -1.44,0.3 -1.96,0.77L8.91,12.7c0.05,-0.23 0.09,-0.46 0.09,-0.7c0,-0.24 -0.04,-0.47 -0.09,-0.7l7.05,-4.11c0.54,0.5 1.25,0.81 2.04,0.81c1.66,0 3,-1.34 3,-3c0,-1.66 -1.34,-3 -3,-3c-1.66,0 -3,1.34 -3,3c0,0.24 0.04,0.47 0.09,0.7L7.04,9.81C6.5,9.31 5.79,9 5,9c-1.66,0 -3,1.34 -3,3c0,1.66 1.34,3 3,3c0.79,0 1.5,-0.31 2.04,-0.81l7.12,4.16c-0.05,0.21 -0.08,0.43 -0.08,0.65c0,1.61 1.31,2.92 2.92,2.92c1.61,0 2.92,-1.31 2.92,-2.92c0,-1.61 -1.31,-2.92 -2.92,-2.92z" />
    </Base>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M16,1H4C2.9,1 2,1.9 2,3v14h2V3h12V1z M19,5H8C6.9,5 6,5.9 6,7v14c0,1.1 0.9,2 2,2h11c1.1,0 2,-0.9 2,-2V7C21,5.9 20.1,5 19,5z M19,21H8V7h11V21z" />
    </Base>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M19,9h-4V3H9v6H5l7,7L19,9z M5,18v2h14v-2H5z" />
    </Base>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M15.41,7.41L14,6l-6,6l6,6l1.41,-1.41L10.83,12z" />
    </Base>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M8.59,16.59L10,18l6,-6l-6,-6l-1.41,1.41L13.17,12z" />
    </Base>
  );
}
