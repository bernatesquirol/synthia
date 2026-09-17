import { render } from "preact";
import "../creator/creator.css";
import { LyricSheet } from "./LyricSheet";

export function mount(root: HTMLElement): void {
  render(<LyricSheet />, root);
}
