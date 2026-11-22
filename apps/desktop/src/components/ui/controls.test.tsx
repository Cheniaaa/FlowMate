import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Field, FieldLabel } from './field';
import { Input } from './input';
import { NativeSelect } from './native-select';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { Textarea } from './textarea';

it('submits only the explicit submit button inside a form', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}>
    <Button>Cancel</Button>
    <Button type="submit">Save</Button>
    <Button asChild><a href="#help">Help</a></Button>
  </form>);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Help' }).hasAttribute('type')).toBe(false);
});

it('keeps labelled native fields, disabled and invalid semantics, and form serialization', () => {
  render(<form aria-label="Example">
    <Field data-invalid>
      <FieldLabel htmlFor="name">Name</FieldLabel>
      <Input id="name" name="name" aria-invalid defaultValue="example" />
    </Field>
    <Field>
      <FieldLabel htmlFor="details">Details</FieldLabel>
      <Textarea id="details" name="details" disabled />
    </Field>
    <NativeSelect name="size" aria-label="Size" defaultValue="small">
      <option value="small">Small</option><option value="large">Large</option>
    </NativeSelect>
    <Checkbox name="enabled" aria-label="Enabled" />
    <RadioGroup name="mode" aria-label="Mode" defaultValue="a">
      <RadioGroupItem value="a" aria-label="A" /><RadioGroupItem value="b" aria-label="B" />
    </RadioGroup>
  </form>);
  expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid')).toBe('true');
  expect((screen.getByRole('textbox', { name: 'Details' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: 'Size' }), { target: { value: 'large' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }));
  fireEvent.click(screen.getByRole('radio', { name: 'B' }));
  expect(Object.fromEntries(new FormData(screen.getByRole('form') as HTMLFormElement)))
    .toEqual({ name: 'example', size: 'large', enabled: 'on', mode: 'b' });
});
