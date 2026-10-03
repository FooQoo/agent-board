export function Header({ boardName }: { boardName: string | null }) {
  return (
    <header className="header">
      <h1 className="header__app">SimpleKanban</h1>
      {boardName !== null && (
        <>
          <span className="header__slash" aria-hidden="true">
            /
          </span>
          <span className="header__board">{boardName}</span>
        </>
      )}
    </header>
  );
}
