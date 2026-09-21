import {
  Clock,
  Code,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Microphone,
  MusicNotes,
  PencilSimpleLine,
  Stack,
  Star,
  TextAa,
  Tray,
  Trash,
  VideoCamera,
} from "@phosphor-icons/react";
import type { Tool } from "../types";

/** Icônes Phosphor (MIT). Les états actifs utilisent la graisse « fill ». */
const TOOL_ICONS = {
  none: Folder,
  text: TextAa,
  image: ImageIcon,
  video: VideoCamera,
  voice: Microphone,
  music: MusicNotes,
  code: Code,
} as const;

interface IconProps {
  size?: number;
  className?: string;
}

export function ToolIcon({ tool, size = 16, className }: IconProps & { tool: Tool }) {
  const Cmp = TOOL_ICONS[tool] ?? Folder;
  return <Cmp size={size} weight="duotone" className={className} aria-hidden />;
}

export function FolderGlyph({ system, open, size = 18 }: IconProps & { system?: boolean; open?: boolean }) {
  const Cmp = system ? Tray : open ? FolderOpen : Folder;
  return <Cmp size={size} weight="fill" className="folder-glyph" aria-hidden />;
}

export const SmartIcons = {
  all: <Stack size={17} weight="duotone" aria-hidden />,
  favorites: <Star size={17} weight="fill" className="star-glyph" aria-hidden />,
  recent: <Clock size={17} weight="duotone" aria-hidden />,
  trash: <Trash size={17} weight="duotone" aria-hidden />,
};

export function HeroIcon() {
  return <PencilSimpleLine size={46} weight="duotone" aria-hidden />;
}
