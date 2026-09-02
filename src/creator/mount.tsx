import { render } from "preact";
import { CreatorApp } from "./CreatorApp";
import "./creator.css";

export function mount(root: HTMLElement): void {
  render(<CreatorApp />, root);
}
