/**
 * What the answer panel draws: the answer typed so far and how the send is going. The form state
 * (`useDecisionRequestForm`) returns the same fields, so a screen passes them on as they are.
 */
export interface DecisionAnswerView {
  /** The chosen option, or null while none is chosen. */
  choiceId: string | null;
  /** The note. */
  text: string;
  /** `sending` stops the input and the close; `failed` keeps the input and shows the retry. */
  phase: 'editing' | 'sending' | 'failed';
  /** `changed`: the question was replaced while the panel was open. `withdrawn`: it is gone. */
  notice: 'changed' | 'withdrawn' | null;
  /** Why the last send failed; shown while `phase` is `failed`. */
  failure: string | null;
  /** The note is over the limit. */
  tooLong: boolean;
  /** The answer can be sent now. */
  sendable: boolean;
  /** The option list and the note cannot be edited. */
  disabled: boolean;
  /** There is an option or a note to clear. */
  hasInput: boolean;
}
