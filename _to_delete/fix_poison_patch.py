p = 'src/lib/DataContext.jsx'
s = open(p, encoding='utf-8').read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, f'{s.count(old)} for {old[:80]!r}'
    s = s.replace(old, new)

# Replace the console.error added in ed93c62 with something that actually stops
# the bad state from being believed and cached.
rep("""  // An empty shelf and a failed query are different facts, and `(data || [])`
  // renders them identically. This cannot invent the books back, but it can
  // stop the failure being invisible in the console — which is how four books
  // became a blank page with nothing to grep for.
  if (currentlyReadingRes?.error) {
    console.error(
      'currently_reading load FAILED — the shelf will render empty, which is not the same as ' +
      'having no books. Check for a pending migration before assuming the data is gone.',
      currentlyReadingRes.error
    );
  }

  const currentlyReading = (currentlyReadingRes.data || [])""",
"""  // A FAILED SHELF QUERY MUST NOT BE RETURNED AS AN EMPTY SHELF.
  //
  // This is the defect the progress_minutes mistake exposed, and it is much
  // worse than the mistake was. loadFromSupabase did not throw when a shelf
  // query errored — it returned a state object with `currentlyReading: []`,
  // because every result is consumed as `(res.data || [])`. The caller has no
  // way to tell that apart from a reader who genuinely has nothing on the go,
  // so it did what it does with any successful load:
  //
  //   supabaseLoadedRef.current = true;   // "this is real data now"
  //   setState(remote);                   // renders the empty shelf
  //   saveSessionCache(user.id, remote);  // caches the empty shelf, 30 min
  //   saveLocal(state);                   // and writes it to localStorage
  //
  // So one failed request became a persistent empty shelf that survived
  // reloading, survived fixing the actual cause, and could only be cleared by
  // closing the tab — sessionStorage does not die on F5. A transient failure
  // was laundered into cached truth.
  //
  // Throwing puts it back on the path that already handles this correctly: the
  // caller catches, falls back to localStorage, and crucially does NOT set
  // supabaseLoadedRef, so nothing is persisted and the next load tries again.
  //
  // Only the shelves. memories, accomplishments and reader_editions degrade to
  // empty on purpose and say so where they do it — losing those costs a
  // progress bar's precision, not a reader's library.
  const shelfFailures = [
    ['currently_reading', currentlyReadingRes],
    ['wishlist_items', wishlistRes],
    ['read_books', readBooksRes],
    ['plans', plansRes],
  ].filter(([, res]) => res?.error);

  if (shelfFailures.length) {
    const detail = shelfFailures.map(([name, res]) => `${name}: ${res.error.message}`).join('; ');
    throw new Error(
      `Shelf load failed, refusing to cache an empty library. A missing column here is ` +
      `usually a migration that has not been applied — or applied to a different project ` +
      `than .env.local points at, or applied without PostgREST reloading its schema ` +
      `cache. ${detail}`
    );
  }

  const currentlyReading = (currentlyReadingRes.data || [])""")

# The catch that now receives it should say what the reader will see.
rep("""          } catch (e) {
            console.error('Failed to load from Supabase, falling back to local', e);
            if (!cancelled) setState(loadLocal());
          }""",
"""          } catch (e) {
            // Deliberately does NOT set supabaseLoadedRef, so the persist effect
            // stays quiet and neither cache learns anything from a failed load.
            console.error('Failed to load from Supabase, falling back to local', e);
            if (!cancelled) setState(loadLocal());
          }""")

open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')
