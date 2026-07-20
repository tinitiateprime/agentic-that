import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "../../services/publishing/queue-runner/src/styles.css";

export default function PublishingLayout({ children }) {
  return <div className="publish-queue-runner">{children}</div>;
}
