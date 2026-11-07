import { PageHead } from "./common";
import { ApplicationCards } from "./ApplicationCards";

export default function HomePage() {
  return <>
    <PageHead title="用经验增强应用" meta="上传过程记录，提取共享经验，再用于新的问诊或解题。" />
    <ApplicationCards />
  </>;
}
