interface GroupedOption {
  value: string;
  group?: string;
}

interface OptionGroup<Option> {
  key: string;
  heading: string | undefined;
  options: Option[];
}

// A repeated heading starts a new run if another group separates its options.
export function groupConsecutiveOptions<Option extends GroupedOption>(
  options: readonly Option[],
): OptionGroup<Option>[] {
  const groups: OptionGroup<Option>[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last !== undefined && last.heading === option.group) {
      last.options.push(option);
    } else {
      groups.push({ key: option.value, heading: option.group, options: [option] });
    }
  }
  return groups;
}
