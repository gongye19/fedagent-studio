import { applicationEntries } from "../domain/applications";
import { applicationRoute, hrefOf } from "../state/route";
import { Panel } from "./console";
import { Tag } from "./common";

export function ApplicationCards() {
  const applications = applicationEntries();
  return (
    <div className="application-cards">
      {applications.map((application) => (
        <Panel key={application.id} title={application.label} extra={application.demo ? <Tag>交互演示</Tag> : undefined}>
          <p>{application.summary}</p>
          <a className="button button--primary" aria-label={`进入${application.label}应用`}
            href={hrefOf(applicationRoute(application.id))}>进入应用</a>
        </Panel>
      ))}
    </div>
  );
}
