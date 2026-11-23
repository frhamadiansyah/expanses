import { createContext } from 'react';

/**
 * Inside a Mac form's floating panel (option C): where the form's title row draws Cancel and its primary button (the
 * panel's foot), and how the panel closes when the form names no way back.
 */
export interface FormPanel {
  foot: HTMLElement | null;
  close: () => void;
}

export const FormPanelContext = createContext<FormPanel | null>(null);
