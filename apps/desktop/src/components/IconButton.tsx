import type { ComponentProps } from 'react';
import {
  ArrowLeft, ArrowUp, Blocks, BookOpen, Bot, ChevronDown, ChevronRight, ChevronUp,
  Ellipsis, Files, Folder, History, Inbox, Library, ListTodo, Maximize2, Minus, PanelLeftClose,
  PanelLeftOpen, Paperclip, PictureInPicture2, Pin, PinOff, Plus, RefreshCw, Settings,
  Layers, Square, SquarePen, Users, X,
} from 'lucide-react';
import { Button } from './ui/button';

const symbols = {
  back: ArrowLeft, close: X, more: Ellipsis, expand: ChevronDown, collapse: ChevronUp,
  folded: ChevronRight, quick: PictureInPicture2, workbench: Maximize2, stop: Square, send: ArrowUp,
  file: Paperclip, folder: Folder, skill: Blocks, settings: Settings, pin: Pin, unpin: PinOff,
  openSidebar: PanelLeftOpen, closeSidebar: PanelLeftClose,
  newSession: SquarePen, assistant: Bot, recent: History, inbox: Inbox, tasks: ListTodo,
  members: Users, memory: BookOpen, library: Library, add: Plus, refresh: RefreshCw, hide: Minus,
  artifacts: Files, context: Layers,
} as const;

export function UiIcon({ name }: { name: keyof typeof symbols }) {
  const Icon = symbols[name];
  return <Icon className="ui-icon" aria-hidden="true" size={16} strokeWidth={1.75}
    fill={name === 'stop' ? 'currentColor' : 'none'} />;
}

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'asChild' | 'size'> & {
  icon: keyof typeof symbols;
  label: string;
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
};

export default function IconButton({ icon, label, variant = 'ghost', size = 'icon', ...props }: IconButtonProps) {
  return <Button {...props} data-icon-action={icon} variant={variant} size={size} aria-label={label} title={label}>
    <UiIcon name={icon} />
  </Button>;
}
