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
];

const instrument: Route = { path: "/", load: () => import("./app/instrument") };

const root = document.getElementById("app")!;
startRouter(root, routes, instrument);
