import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the dashboard and agent desk entry', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /fantasy football mnps dashboard/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agent Desk' })).toBeInTheDocument();
});
