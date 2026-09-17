import { startRouter, type Route } from "./router";

const routes: Route[] = [
  {
    path: "/performance_creator",
    load: () => import("./creator/mount"),
  },
  {
    path: "/performance",
    load: () => import("./viewer/mount"),
  },
  // The same piece, as words on a phone: no clock, no audio, no sync.
  {
    path: "/lyrics",
    load: () => import("./viewer/mountLyrics"),
  },
];

const instrument: Route = { path: "/", load: () => import("./app/instrument") };

const root = document.getElementById("app")!;
startRouter(root, routes, instrument);
