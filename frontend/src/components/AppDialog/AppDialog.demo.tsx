import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Button } from "../Button";
import { appAlert, appConfirm, appPrompt } from "./AppDialog";

export function AppDialogDemo() {
  return (
    <DemoSection title="AppDialog" note="Shared replacement for app-wide alert, confirm, and prompt flows.">
      <DemoGrid>
        <DemoSample label="dialog types">
          <Button onClick={() => void appAlert("Project saved.")}>Alert</Button>
          <Button onClick={() => void appConfirm("Replace current project?")}>Confirm</Button>
          <Button onClick={() => void appPrompt("Preset name", "Wide master")}>Prompt</Button>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
