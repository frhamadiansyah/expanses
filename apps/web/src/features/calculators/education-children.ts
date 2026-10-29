/** What a child is called where the page lists them: the name typed, else "Child 1", "Child 2" by place. */
export function childLabel(name: string, index: number): string {
  return name.trim() || `Child ${index + 1}`;
}

/** The goal a child's calculator is saved as: "Education fund · Nadia", or plain "Education fund" while unnamed. */
export function educationGoalName(childName: string): string {
  const name = childName.trim();
  return name ? `Education fund · ${name}` : 'Education fund';
}
