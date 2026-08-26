# JOB D: a customer was given the wrong day

**Raised by:** Support (Marcus, 26 Aug)
**Queue age:** 2 days

Trelawney have a late backflow test booked and the confirmation we sent them has
the wrong date on it. Marcus checked the work order and the stored time is right,
so it is what we print that is wrong.

He says this is the same thing as W-4412, which has been closed twice as cannot
reproduce. Both reports came in the summer. Nobody has managed to make it happen
in the winter, and it has never once failed on the build box.

Everything the customer sees is UK local. Everything we store is UTC. Somewhere
those two are being treated as the same thing.
