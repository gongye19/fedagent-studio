import { PageHead } from "./common";
import { ApplicationCards } from "./ApplicationCards";

export default function AppsPage() {
  return (
    <>
      <PageHead title="应用" meta="选择应用，使用联邦任务发布的经验包。" />
      <ApplicationCards />
    </>
  );
}
