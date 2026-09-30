export interface Answer {
  handle: string;
  reply: string;
  failed: boolean;
}

/**
 * What the asker is resumed with once everyone it asked has answered.
 */
export function answersFor(answers: Answer[]): string {
  const said = answers.map((answer) => {
    if (answer.failed) return `@${answer.handle} could not complete that.`;

    const reply = answer.reply.trim();
    return reply.length > 0
      ? `@${answer.handle} replied:\n\n${reply}`
      : `@${answer.handle} finished without a reply.`;
  });

  if (answers.length === 1) {
    return answers[0]!.failed
      ? `${said[0]}\n\nDecide what to do next.`
      : `${said[0]}`;
  }

  return `${said.join("\n\n---\n\n")}\n\nThat is everyone you asked. Carry on with all of it.`;
}
