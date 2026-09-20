/** Explicit loading, empty and error states, written as directions. */
export { Loading } from "./ui";

export function Empty({ title, action }: { title: string; action?: string }) {
  return (
    <div>
      <div>{title}</div>
      {action ? <div className="msg mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, next }: { message: string; next?: string }) {
  return (
    <div role="alert">
      <div className="msg red">{message}</div>
      {next ? <div className="msg mt-1">{next}</div> : null}
    </div>
  );
}
