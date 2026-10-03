import WebsiteAssistant from "./WebsiteAssistant";

function readableTextColor(hex, light = "#ffffff", dark = "#111815") {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return light;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return ((red * 299) + (green * 587) + (blue * 114)) / 1000 >= 150 ? dark : light;
}

export default function WebsiteAssistantFrame({ children, project, theme, previewToken = null }) {
  const primary = project.siteSpec.visualDirection.primaryColor;
  const accent = project.siteSpec.visualDirection.accentColor;
  const style = {
    "--site-primary": primary,
    "--site-accent": accent,
    "--site-on-primary": readableTextColor(primary),
    "--site-on-accent": readableTextColor(accent),
  };
  const source = previewToken ? { previewToken, theme } : { publicSlug: project.publicSlug };

  return <div className={previewToken ? "waas-assistant-host waas-preview-page" : "waas-assistant-host"} style={style}>
    {children}
    <WebsiteAssistant source={source} businessName={project.businessName} phone={project.businessProfile?.phone} />
  </div>;
}
