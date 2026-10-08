import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import type { ImageCategories } from '@/lib/annotations';
import { SuggestionsPanel } from '../suggestions-panel';

type Category = { code: string | null; name: string };

const MICRO: Category = { code: '1.1', name: 'Microparticle' };
const HEXAGON: Category = { code: '1.2', name: 'Hexagon' };
const FAN: Category = { code: '1.3', name: 'Fan-like Hexagon' };

// An ML suggestion with three labels in rank order.
const ml = (
    labels: Category[],
    confidences = [0.71, 0.14, 0.06],
): NonNullable<ImageCategories['ml']> => ({
    modelVersion: 'seed-v0',
    createdAt: new Date('2026-10-08T00:00:00Z'),
    labels: labels.map((l, i) => ({ ...l, confidence: confidences[i] ?? 0 })),
});

// Real en.json, so a missing or misspelt key fails the test.
const show = (categories: ImageCategories) =>
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <SuggestionsPanel categories={categories} />
        </NextIntlClientProvider>,
    );

describe('SuggestionsPanel', () => {
    it('expert + ML that agree: both shown, labels in rank order, agree mark', () => {
        show({ expert: MICRO, ml: ml([MICRO, HEXAGON, FAN]) });

        // Once under Expert, once as the model's first label.
        expect(screen.getAllByText('1.1 Microparticle')).toHaveLength(2);
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            '1.1 Microparticle71%',
            '1.2 Hexagon14%',
            '1.3 Fan-like Hexagon6%',
        ]);
        expect(screen.getByText('Model seed-v0')).toBeInTheDocument();
        expect(screen.getByText('Expert and model agree')).toBeInTheDocument();
        expect(screen.queryByText('Expert and model differ')).toBeNull();
    });

    it('expert + ML that differ: differ mark', () => {
        show({ expert: MICRO, ml: ml([HEXAGON, MICRO, FAN]) });

        expect(screen.getByText('Expert and model differ')).toBeInTheDocument();
        expect(screen.queryByText('Expert and model agree')).toBeNull();
    });

    it('ML only: "No expert category", no mark, percentages rounded', () => {
        show({ expert: null, ml: ml([FAN, HEXAGON, MICRO], [0.396, 0.335, 0.124]) });

        expect(screen.getByText('No expert category')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('34%')).toBeInTheDocument();
        expect(screen.getByText('12%')).toBeInTheDocument();
        expect(screen.queryByText('Expert and model agree')).toBeNull();
        expect(screen.queryByText('Expert and model differ')).toBeNull();
    });

    it('expert only: "Pending" with explanation, no labels, no mark', () => {
        show({ expert: MICRO, ml: null });

        expect(screen.getByText('1.1 Microparticle')).toBeInTheDocument();
        expect(screen.getByText('Pending')).toBeInTheDocument();
        expect(
            screen.getByText('The model has not classified this image yet. You can annotate it now.'),
        ).toBeInTheDocument();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.queryByText('Expert and model agree')).toBeNull();
        expect(screen.queryByText('Expert and model differ')).toBeNull();
    });

    it('neither: "No expert category" and "Pending"', () => {
        show({ expert: null, ml: null });

        expect(screen.getByText('No expert category')).toBeInTheDocument();
        expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('class without a code: name only', () => {
        show({ expert: { code: null, name: 'Microparticle' }, ml: null });

        expect(screen.getByText('Microparticle')).toBeInTheDocument();
    });
});