import { Button } from "../Button";
import { appAlert, appConfirm, appPrompt } from "./state";

export function AppDialogSolidDemo() {
  return (
    <div class="ui-toolbar">
      <Button size="sm" onClick={() => void appAlert("Alert dialog preview.")}>Alert</Button>
      <Button size="sm" onClick={() => void appConfirm("Confirm dialog preview.")}>Confirm</Button>
      <Button size="sm" onClick={() => void appPrompt("Prompt dialog preview.", "Untitled")}>Prompt</Button>
    </div>
  );
}
