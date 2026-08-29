import { byActiveThenName } from './pos-menu.controller';

/**
 * The POS uses `posBranches[0]` as its default branch, so this ordering decides
 * which till a cashier lands on. A live incident: a new branch named "Johar
 * Town" was created and marked inactive; sorted by name alone it came before
 * "Pine Avenue" and the POS opened on a branch that refuses orders.
 */
const B = (name: string, is_active: boolean) => ({ name, is_active });

describe('POS branch ordering', () => {
    it('REGRESSION: an inactive branch never sorts ahead of an active one', () => {
        const list = [B('Johar Town', false), B('Pine Avenue', true)];
        list.sort(byActiveThenName);
        expect(list[0].name).toBe('Pine Avenue');
    });

    it('keeps name order among active branches', () => {
        const list = [B('Zulu', true), B('Alpha', true), B('Mike', true)];
        list.sort(byActiveThenName);
        expect(list.map((b) => b.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
    });

    it('keeps name order among inactive branches too', () => {
        const list = [B('Zulu', false), B('Alpha', false)];
        list.sort(byActiveThenName);
        expect(list.map((b) => b.name)).toEqual(['Alpha', 'Zulu']);
    });

    it('puts every active branch ahead of every inactive one', () => {
        const list = [
            B('Aaa', false),
            B('Zzz', true),
            B('Bbb', false),
            B('Yyy', true),
        ];
        list.sort(byActiveThenName);
        expect(list.map((b) => b.is_active)).toEqual([
            true,
            true,
            false,
            false,
        ]);
        expect(list.map((b) => b.name)).toEqual(['Yyy', 'Zzz', 'Aaa', 'Bbb']);
    });

    it('is stable when every branch is inactive — the POS still gets a default', () => {
        const list = [B('Beta', false), B('Alpha', false)];
        list.sort(byActiveThenName);
        expect(list[0].name).toBe('Alpha');
    });
});
