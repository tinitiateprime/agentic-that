import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "./content-manager.css";

export default function ContentManagerLayout({ children }) {
  return <div className="content-manager-scope">{children}</div>;
}
