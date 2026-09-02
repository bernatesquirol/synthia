import { render } from "preact";
import "../creator/creator.css";
import { ViewerApp } from "./ViewerApp";

export function mount(root: HTMLElement): void {
  render(<ViewerApp />, root);
}
