import type { Site } from "@lunar/core";
import sitesJson from "../../../../data/sites.json";
import { App } from "@/components/App";

const sites = (sitesJson as Site[]).filter((s) => !s.todo);

export default function Home() {
  return <App initialSites={sites} />;
}
