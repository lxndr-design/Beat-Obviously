import styles from "./RadioGroup.module.css";

export interface RadioGroupOption<T extends string | number> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string | number> {
  label?: string;
  ariaLabel: string;
  value: T;
  options: Array<RadioGroupOption<T>>;
  onChange: (value: T) => void;
}

export function RadioGroup<T extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: RadioGroupProps<T>) {
  return (
    <div className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.control} role="radiogroup" aria-label={ariaLabel}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.button} ${selected ? styles.active : ""}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
