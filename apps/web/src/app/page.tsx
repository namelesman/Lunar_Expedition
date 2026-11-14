import type { Site } from "@lunar/core";
import sitesJson from "../../../../data/sites.json";
import { ClientApp } from "@/components/ClientApp";

const sites = (sitesJson as Site[]).filter((s) => !s.todo);

export default function Home() {
  return <ClientApp initialSites={sites} />;
}
