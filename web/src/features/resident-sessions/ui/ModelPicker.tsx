import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import type { ModelOption } from '../api';

/** The model picker: the shared dropdown menu with single-choice items, as the project switcher uses it. */
export function ModelPicker({
  id,
  value,
  models,
  onChange,
  disabled,
}: {
  id: string;
  /** The model id; the empty string is the tool's default. */
  value: string;
  models: readonly ModelOption[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const name =
    value === ''
      ? t('resident.modelDefault')
      : (models.find((m) => m.id === value)?.label ?? value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="m"
          className="resident-model"
          aria-label={`${t('resident.modelLabel')}: ${name}`}
        >
          <span className="resident-model__name">{name}</span>
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('resident.modelLabel')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{t('resident.modelDefault')}</DropdownMenuRadioItem>
          {models.map((model) => (
            <DropdownMenuRadioItem key={model.id} value={model.id}>
              {model.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
