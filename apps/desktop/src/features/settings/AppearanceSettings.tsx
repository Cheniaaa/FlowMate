import { useId } from 'react';
import { saveTextSize, useTextSize, type TextSize } from '../../components/documentAppearance';
import ThemeToggle from '../../components/ThemeToggle';
import { Field, FieldGroup, FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';

export default function AppearanceSettings() {
  const size = useTextSize();
  const id = useId();
  return <section>
    <h2>应用外观</h2>
    <FieldGroup className="max-w-72">
      <div><ThemeToggle /></div>
      <Field>
        <FieldLabel htmlFor={id}>文字大小</FieldLabel>
        <NativeSelect id={id} value={size} onChange={event => saveTextSize(event.target.value as TextSize)}>
          <NativeSelectOption value="compact">紧凑</NativeSelectOption>
          <NativeSelectOption value="standard">标准</NativeSelectOption>
          <NativeSelectOption value="large">大字</NativeSelectOption>
        </NativeSelect>
      </Field>
    </FieldGroup>
  </section>;
}
