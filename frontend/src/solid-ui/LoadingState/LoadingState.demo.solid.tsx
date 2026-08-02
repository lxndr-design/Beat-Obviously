import { LoadingIndicator, LoadingSkeleton } from "./LoadingState.solid";

export function LoadingStateDemo() {
  return (
    <section>
      <h2>Loading states</h2>
      <LoadingIndicator size="sm" label="Refreshing" />
      <LoadingIndicator label="Loading instruments" />
      <LoadingIndicator size="lg" label="Preparing session" />
      <LoadingSkeleton variant="media" label="Loading project" />
      <LoadingSkeleton variant="row" label="Loading row" />
    </section>
  );
}
