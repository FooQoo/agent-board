/**
 * What the answer panel draws: the answer held so far and how the send is going. The run through
 * the questions (`useAnswerFlow`) builds it from the page's book of held answers.
 */
export interface DecisionAnswerView {
  /** The chosen option, or null while none is chosen. */
  choiceId: string | null;
  /** The note. */
  text: string;
  /** `sending` stops the input and the close; `failed` keeps the input and shows the retry. */
  phase: 'editing' | 'sending' | 'failed';
  /**
   * `changed`: the question was replaced while the panel was open. `answered`: it was answered
   * elsewhere. `withdrawn`: it is gone. The last two keep the input readable and unsendable.
   */
  notice: 'changed' | 'answered' | 'withdrawn' | null;
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
