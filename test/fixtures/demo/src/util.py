import os
from dataclasses import dataclass

@dataclass
class Item:
    title: str
    done: bool = False

def summarize(items: list[Item]) -> str:
    """Return a one-line summary.
    Handles empty lists."""
    remaining = [i for i in items if not i.done]
    return f"{len(remaining)} of {len(items)} left"  # count

if __name__ == "__main__":
    print(summarize([Item("a"), Item("b", True)]))
