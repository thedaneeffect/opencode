import { useTheme } from "../../context/theme"
import { useDirectory } from "../../context/directory"

export function Footer() {
  const { theme } = useTheme()
  const directory = useDirectory()
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
    </box>
  )
}
