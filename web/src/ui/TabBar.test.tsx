import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

test('tab bar shows 4 labelled tabs and a central add button', () => {
  const go = vi.fn();
  render(<TabBar current="home" onGo={go} />);
  expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual(['Home','Bills','','Reports','Settings']);
  fireEvent.click(screen.getByLabelText('Add'));
  expect(go).toHaveBeenCalledWith('add');
});
